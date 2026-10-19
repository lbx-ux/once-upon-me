#!/usr/bin/env bash
#
# deploy-web.sh —— 前端（Next）那一半上服务器：一次性准备 + 日常部署 + 回滚
#
# ```
#   ./scripts/deploy-web.sh --provision     # 一次性（幂等）：装运行时、建目录、写 web.env / unit / nginx conf，一律**不启动**
#   ./scripts/deploy-web.sh --assets        # 一次性：把本机作品搬到 /var/lib/xiaozhujue/assets（183 MB）
#   ./scripts/deploy-web.sh                 # 日常：只传代码（压缩后约 1.6 MB）
#   ./scripts/deploy-web.sh --full          # 含 public/（61 MB；美术变过才用）
#   ./scripts/deploy-web.sh --go-live       # 上线那一刻：启用 nginx site + web unit（默认不碰这两个开关）
#   ./scripts/deploy-web.sh --rollback      # 换回上一份 .next（秒级，不重新构建）
#   ./scripts/deploy-web.sh --test-page     # 在 80 上放一个 Nginx 静态占位页，用来测"公网连不连得上"
#   ./scripts/deploy-web.sh --expect='刚改的那句话'   # 判别判据：新构建里搜得到它才算成（见第 6 条）
# ```
#
# ★ 它**不碰配置**里的密钥，也**不碰作品**：
#   · `/etc/xiaozhujue/web.env` 只在 `--provision` 里生成一次，之后想改就 ssh 上去改；
#   · `/var/lib/xiaozhujue/assets` 只有 `--assets` 会写（首次搬运），日常部署一个字节都不动。
#   "部署手一抖抹掉作品"是一次真实的数据损失，数据与代码分开正是为了这件事。
#
# 六条决定，每条都对应一次会咬人的后果：
#
# 1. **构建在服务器上做**（不是本机构建再上传产物）。`sharp` 是原生模块，Windows 编出来的
#    二进制在 Linux 上跑不起来；而本机没有 Docker、WSL 也没装发行版（2026-10-19 实测）。
#    所以上传的是**源码**，不是"打包好的包"。
#
# 2. **上传走 tar + scp，不走 rsync**。本机 Git Bash **没有 rsync**（`which rsync` 为空；
#    服务器上有 3.2.7）。仓库里 `pull-from-server.sh` 早就因为同一个原因写成了 tar，
#    方向相反。★ 工单 10 原来那句"rsync 源码"在本机跑不起来。
#
# 3. **用 `git archive` 打包，不用 `tar` 打工作区**。两个理由：
#    · 它只含**已跟踪**文件 —— `.env.local` / `.out` / `.next*` / `.local-db` /
#      `models.runtime.json` 天然不入包，排除表不会漂（漏一条就是把密钥搬上去）；
#    · 它按 `.gitattributes` 的 `* text=auto eol=lf` 输出 **LF**，而工作区里还有一批 CRLF
#      文件（`.gitattributes` 自己的账目写着 63 个 `i/lf w/crlf`）——`patches/*.patch`
#      尤其怕这个（CRLF 的 diff 会应用失败）。
#
# 4. **构建到 `.next-new` 再换目录，绝不就地 build**。正在服务的进程手里那份 manifest 是
#    启动时读的，而盘上的 chunk 被换掉之后，浏览器记着的旧 chunk 名字就没了 ——
#    页面开始 "Loading chunk failed"。这个故障形态写在 `next.config.ts` 的文件头
#    （那次是两个 dev server 抢同一个 `.next/`）。换目录顺带白送一个**秒级回滚**。
#
# 5. **install 只在指纹变过时跑**。`pnpm install --frozen-lockfile` 在 2C2G 上是最慢的一步
#    （靠那 2G swap 撑），而改组件、改样式根本不碰依赖。指纹取 `pnpm-lock.yaml` +
#    `patches/*` —— ★ 补丁**必须**算进去：它是在 install 那一刻打进 next 包里的。
#
# 6. **冒烟要带重试，判据要能判别**。`systemctl restart` 之后进程要几秒才 listening，
#    "重启完立刻 curl"在慢机器上会偶发地红一次，那种红会让人学会忽略这个脚本；
#    而光"服务活着"证明不了新代码上去了 —— 所以 `--expect=TEXT` 会在**新构建**里
#    搜那句话，搜不到就判失败并自动回滚（见 `--expect`）。
#
# 7. **构建期间停服 + 串行 + 小堆**。那台机器 1613 MB，"构建期间站点照常服务"在它上面
#    **做不到** —— 2026-10-19 不做的时候它进了换页死亡螺旋：available 594 → 157 MB，
#    **ssh 连握手都排不上队**，nginx / Java / MySQL 一起对外超时，部署卡在构建上 27 分钟
#    （最后是人去控制台强制重启的）。所以：构建前停 web 进程让出内存、
#    `NEXT_BUILD_CPUS=1` 串行静态生成、`--max-old-space-size=512` 小堆（`XZJ_BUILD_HEAP` 可调）。
#    ★ 代价说得明明白白：构建期间站点**不可用**，时长就是构建那几分钟。
#      不受控地锁死整机比"诚实地停几分钟"糟得多 —— 前者连 ssh 都进不去，只能去控制台。
#
set -euo pipefail

HOST="${XZJ_HOST:-root@123.56.148.105}"
APP_DIR="/opt/xiaozhujue/app"
ASSETS_DIR="/var/lib/xiaozhujue/assets"
WEB_ENV="/etc/xiaozhujue/web.env"
UNIT="xiaozhujue-web"
SERVICE="xiaozhujue-web.service"
PORT=3000

cd "$(dirname "$0")/.."

rsh() { ssh -o BatchMode=yes "$HOST" "$@"; }

say() { echo "── $*"; }
die() { echo "✗ $*" >&2; exit 1; }

# ══════════════════════════════════════════════════════════════════════════
# --provision：一次性（幂等）。★ 它**不启动** nginx、也**不启用** web unit ——
# 那两件事是 `--go-live`，是"前端上线"这个动作本身，不由准备脚本代做。
# ══════════════════════════════════════════════════════════════════════════
provision() {
  say "探一次 ssh（免密）"
  rsh true || die "ssh $HOST 进不去。先确认公钥（见工单 03）"

  say "装 nginx 与 Node 24（apt 自带的 nodejs 是 18.19，Next 15 要 ≥20）"
  rsh 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq nginx curl ca-certificates >/dev/null && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null && node -v'

  say "装 pnpm（与开发机同大版本：lockfile 与 pnpm-workspace.yaml 的 allowBuilds 都认版本）"
  rsh 'npm i -g pnpm@12 >/dev/null 2>&1 || npm i -g pnpm@12 --registry=https://registry.npmmirror.com >/dev/null; pnpm -v'

  say "建代码目录（属主 xzj：服务不拿 root 跑，见工单 03 那条偏离）"
  rsh "install -d -o xzj -g xzj '$APP_DIR' && ls -ld '$APP_DIR'"

  # ★ 实测到的一个意外：`getent passwd xzj` 的家目录是 **/var/lib/xiaozhujue** ——
  #   也就是**作品那个目录**。pnpm 的 store 与缓存默认落在家目录下，于是装一次依赖
  #   就会往作品目录里塞 600 MB 缓存：`du -sh /var/lib/xiaozhujue` 从此不再等于
  #   "作品有多大"，而工单 11 那条"到 70% 提醒一次"的读数正是靠它。
  #   所以构建/安装一律把 HOME 指到 /var/cache/xiaozhujue —— 缓存归缓存，作品归作品。
  say "建构建缓存目录（pnpm 的 store 不落进作品目录）"
  rsh "install -d -o xzj -g xzj /var/cache/xiaozhujue && ls -ld /var/cache/xiaozhujue"

  # ── web.env ──────────────────────────────────────────────────────────────
  # 密钥**只从本机 .env.local 取模型那几组**；三样东西必须由服务器自己给：
  #   · BACKEND_URL —— 服务器上是回环那个 8080（★ 不是 http://127.0.0.1：漏了端口
  #     就成了"Next 打自己"的环，BFF 8 秒超时兜住，症状是登录永远"稍后再试"）
  #   · INTERNAL_TOKEN / APP_JWT_SECRET —— 必须与 /etc/xiaozhujue/api.yml 里
  #     那两把**逐字相同**（不相同的症状：前者每个请求 403，后者登录 200 之后全 401）
  #   ★ 值全程不出现在屏幕上：本机拼、scp 过去、在服务器上补齐两把令牌。
  say "写 $WEB_ENV（640 root:xzj）"
  local tmp
  tmp="$(mktemp)"
  # tr -d '\r'：`.env.local` 是 Windows 上敲的，CRLF 会让每个值尾部多一个 \r ——
  # 那把带 \r 的 key 送上去就是 401，而它看起来"字符完全一样"。
  grep -E '^(LLM|IMAGE|VISION|TTS)_[A-Z0-9_]*=' .env.local | tr -d '\r' > "$tmp" || true
  cat >> "$tmp" <<'ENVEOF'

# ── 以下由 scripts/deploy-web.sh --provision 写死（服务器专属，与开发机不同）──────
BACKEND_URL=http://127.0.0.1:8080
ASSET_ROOT=/var/lib/xiaozhujue/assets
# ★ 不是 /etc/xiaozhujue/models.json（.env.example 里那句建议在服务器上会失败）：
#   管理页写这份配置是"临时文件 + rename"（lib/settings/runtime-config.ts），
#   而 rename 要的是**目录可写**，/etc/xiaozhujue 是 750 root:xzj —— 服务以 xzj 跑，
#   写不进去。放在 xzj 自己的数据目录里，权限问题就不存在。
MODEL_CONFIG_FILE=/var/lib/xiaozhujue/models.json
ENVEOF
  [ "$(grep -cE '^(LLM|IMAGE|VISION|TTS)_' "$tmp")" -gt 0 ] || die ".env.local 里没读到模型密钥，别硬上"
  # ★ 覆盖前先留一份备份：`--provision` 是幂等的，但它**每次都会重写 web.env**，
  #   而人可能已经 ssh 上去手工加过变量（比如把 LLM_MAX_TOKENS 提上去）。
  #   留 bak 与 api.yml 那边一个规矩（服务器上就有 api.yml.bak-<时间>）。
  rsh "test -f $WEB_ENV && cp -a $WEB_ENV $WEB_ENV.bak-\$(date +%Y%m%d%H%M) || true"
  scp -q "$tmp" "$HOST:/tmp/xzj-web.env.new"
  rm -f "$tmp"

  rsh 'set -e
    TOK=$(awk -F": *" "/^[[:space:]]*internal-token:/{print \$2; exit}" /etc/xiaozhujue/api.yml)
    JWT=$(awk -F": *" "/^[[:space:]]*secret:/{print \$2; exit}" /etc/xiaozhujue/api.yml)
    [ -n "$TOK" ] || { echo "api.yml 里没读到 internal-token"; exit 1; }
    [ -n "$JWT" ] || { echo "api.yml 里没读到 jwt secret"; exit 1; }
    grep -v "^INTERNAL_TOKEN=\|^APP_JWT_SECRET=" /tmp/xzj-web.env.new > /tmp/xzj-web.env.clean
    printf "INTERNAL_TOKEN=%s\nAPP_JWT_SECRET=%s\n" "$TOK" "$JWT" >> /tmp/xzj-web.env.clean
    install -m 640 -o root -g xzj /tmp/xzj-web.env.clean /etc/xiaozhujue/web.env
    rm -f /tmp/xzj-web.env.new /tmp/xzj-web.env.clean
    ls -l /etc/xiaozhujue/web.env'

  # ── systemd unit（写完**不 enable、不 start**）────────────────────────────
  # ★ 这段 heredoc 是**未加引号**的（要展开 $APP_DIR / $pnpm_bin 那几个），
  #   所以注释里**不能出现反引号**——它会被本地当命令替换执行掉。
  #   2026-10-19 第一次跑就咬了一次：注释里那对反引号让脚本打出一句
  #   `-: command not found`，而落地的 unit 里那句话被吃掉了。
  # ★ `[Install]` 段必须有：缺了它 `systemctl is-enabled` 回 `static`、
  #   `enable` 直接失败——而 `enable` 正是 `--go-live` 的第一步。
  say "写 /etc/systemd/system/$SERVICE（不启用）"
  local pnpm_bin
  pnpm_bin="$(rsh 'command -v pnpm')"
  [ -n "$pnpm_bin" ] || die "服务器上没有 pnpm"
  rsh "cat > /etc/systemd/system/$SERVICE" <<UNITEOF
[Unit]
Description=xiaozhujue-web（Next.js 生产，前端那一半）
After=network-online.target xiaozhujue-api.service
Wants=network-online.target

[Service]
Type=simple
User=xzj
Group=xzj
WorkingDirectory=$APP_DIR
EnvironmentFile=$WEB_ENV
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOSTNAME=127.0.0.1
# ★ 给它戴帽子：那台机器 available 只有 ~590 MB，Java 已经吃着 -Xmx320m，
#   宁可让它多用 swap，也别被 OOM killer 挑中（2G swap 就是为这种事加的）
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=$pnpm_bin start
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
# ★ read-only（不是 true）：xzj 的家目录就是作品目录 /var/lib/xiaozhujue，
#   运行时用不到 pnpm 的 store，但把它整个藏掉会冒出难查的 EACCES
ProtectHome=read-only
PrivateTmp=true
# ★ 前缀 "-" = 路径不存在也不算错（systemd 否则会拒绝启动）
ReadWritePaths=-/opt/xiaozhujue/app/.next/cache -/var/lib/xiaozhujue

[Install]
WantedBy=multi-user.target
UNITEOF
  rsh "systemctl daemon-reload; echo \"is-enabled: \$(systemctl is-enabled $SERVICE 2>&1) / is-active: \$(systemctl is-active $SERVICE 2>&1)\""

  # ── nginx site（写完**不链接、不启动**）──────────────────────────────────
  say "写 /etc/nginx/sites-available/xiaozhujue（不链接）"
  rsh 'cat > /etc/nginx/sites-available/xiaozhujue' <<'NGINXEOF'
# xiaozhujue —— 公网那一侧只有这一个进程
#
# 四行必须写对，每一行都对应一次实测过的坏结局：
#   client_max_body_size     录音克隆要传音频，默认 1m 会在上传那一刻 413
#   proxy_read_timeout 900s  出图那条流 20–35 分钟、中间几分钟不吐字；
#                            默认 60 秒会在**整本生成的第 1 页**就掐断
#   proxy_buffering off      SSE 不关缓冲，字会堆在 Nginx 里到最后一齐吐出来
#   /backend/ 末尾那个斜杠    少了它 /backend/api/x 会变成 /backendapi/x（404）
server {
  listen 80 default_server;
  server_name 123.56.148.105;

  client_max_body_size 24m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "";
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
    proxy_buffering off;
  }

  # 给**开发机**用的一条：本机 .env.local 写 BACKEND_URL=http://123.56.148.105/backend
  # 就不必本地再起一个 Java。它不是给线上用的（线上 BFF 直连回环 8080）。
  # ★ 它一通到 Java，而 Java 仍然要 X-Internal-Token，缺了就是 403（/api/health 豁免）。
  location /backend/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
NGINXEOF

  say "确保 nginx 现在**不跑**、默认站点**不占 80**"
  # 装 nginx 时 apt 会顺手把它拉起来并启用 Ubuntu 的默认站点 ——
  # 那等于在公网上放一个"欢迎来到 nginx"，而我们这一步只要准备、不上线。
  rsh 'rm -f /etc/nginx/sites-enabled/default; systemctl disable --now nginx >/dev/null 2>&1 || true; systemctl is-active nginx; ss -lntp | grep -c ":80 " || echo "80 没有任何人在听"'

  say "准备完成。当前版本："
  rsh 'node -v; pnpm -v; nginx -v 2>&1; echo "unit: $(systemctl is-enabled xiaozhujue-web 2>&1) / $(systemctl is-active xiaozhujue-web 2>&1)"; echo "web.env 键（只列名字与有没有值）："; awk -F"=" "/^[A-Z]/{print \$1\" = \"(length(\$2)>0?\"有值\":\"空\")}" /etc/xiaozhujue/web.env'
}

# ══════════════════════════════════════════════════════════════════════════
# --assets：把本机作品搬上去（一次性）。★ 保住 u/<userId>/ 那一层 ——
# 代码只认 u/<id>/ 底下那一片，搬成一棵平铺的树等于搬丢了。
# ★ 顺带说清一件事：作品是**按 user id 分片**的，服务器那个库里的 id 与本地那个
#    未必一一对应。u/1 与 u/2 对得上（两边的种子账号都是先 123456 再 100000），
#    其余几片（5/17/18/20/22/25）是本地那个 H2 里才有的账号，搬上去也**没人看得到**，
#    除非那些手机号在服务器上注册成同样的 id（工具：scripts/adopt-legacy-assets.mts）。
# ══════════════════════════════════════════════════════════════════════════
sync_assets() {
  [ -d .out/web/u ] || die "本机没有 .out/web/u，没什么可搬的"
  local n_local
  n_local="$(find .out/web/u -type f | wc -l)"
  say "本地 u/ 下 $n_local 个文件（$(du -sh .out/web/u | cut -f1)），开始流式传（不落中转文件）"
  tar cf - -C .out/web u | rsh "tar xf - -C '$ASSETS_DIR' && chown -R xzj:xzj '$ASSETS_DIR'"
  say "核对（文件数必须一样）"
  rsh "echo \"远端 \$(find $ASSETS_DIR/u -type f | wc -l) 个文件 / \$(du -sh $ASSETS_DIR | cut -f1)\"; ls $ASSETS_DIR/u"
}

# ══════════════════════════════════════════════════════════════════════════
# 打包：git archive（见文件头第 3 条）。代码档约 1.6 MB，全量档约 61 MB。
# ══════════════════════════════════════════════════════════════════════════
CODE_PATHS=(src scripts package.json pnpm-lock.yaml pnpm-workspace.yaml patches
            next.config.ts postcss.config.mjs tsconfig.json tsconfig.engine.json eslint.config.mjs)

pack() {
  local full="$1" sha out
  sha="$(git rev-parse --short HEAD)"
  out=".out/web-$sha.tar.gz"
  mkdir -p .out
  if [ "$full" = "1" ]; then
    git archive HEAD --format=tar.gz -o "$out" "${CODE_PATHS[@]}" public
  else
    git archive HEAD --format=tar.gz -o "$out" "${CODE_PATHS[@]}"
  fi
  echo "$out"
}

# ══════════════════════════════════════════════════════════════════════════
deploy() {
  local full="$1" expect="${2:-}"
  local dirty
  dirty="$(git status --porcelain | wc -l)"
  if [ "$dirty" -gt 0 ]; then
    # ★ 不拦，但要说清：`git archive HEAD` 打的是**已提交**那一份，
    #   工作区里那些改动不会上去。不说这句，症状是"我改了怎么没生效"。
    say "★ 工作区有 $dirty 处未提交的改动 —— 面包不含它们（git archive 只取 HEAD）"
  fi

  local archive sha
  archive="$(pack "$full")"
  sha="$(git rev-parse --short HEAD)"
  say "包：$archive（$(du -h "$archive" | cut -f1)，commit $sha）"

  say "上传"
  scp -q "$archive" "$HOST:/tmp/"

  say "解包（先清掉 src/scripts —— tar 只覆盖不删除，留着已删的路由会让它照样被构建出来）"
  local clean="src scripts"
  if [ "$full" = "1" ]; then clean="src scripts public"; fi
  rsh "set -e; cd '$APP_DIR'; rm -rf $clean; tar xzf '/tmp/$(basename "$archive")'; chown -R xzj:xzj '$APP_DIR'; rm -f '/tmp/$(basename "$archive")'"

  say "依赖指纹（lockfile + patches）"
  local fp_local fp_remote
  fp_local="$(cat pnpm-lock.yaml patches/* | sha256sum | cut -d' ' -f1)"
  fp_remote="$(rsh "cat '$APP_DIR/.deployed-deps' 2>/dev/null || true")"
  if [ "$fp_local" != "$fp_remote" ]; then
    say "指纹变了 → pnpm install（2C2G 上这是最慢的一步，可能要几分钟）"
    # ★ HOME 指到 /var/cache/xiaozhujue：xzj 的家目录就是作品目录，
    #   不指走的话 pnpm 会往作品里塞 600 MB store（同一个坑也在 provision 里写了）
    rsh "sudo -u xzj env HOME=/var/cache/xiaozhujue bash -lc 'cd $APP_DIR && pnpm install --frozen-lockfile'"
    rsh "printf '%s\n' '$fp_local' > '$APP_DIR/.deployed-deps' && chown xzj:xzj '$APP_DIR/.deployed-deps'"
  else
    say "指纹没变 → 跳过 install"
  fi

  # ★ 构建期间先把 web 那个进程停掉。★ 这一条是 2026-10-19 用一次整机锁死换来的：
  #   那台机器只有 1613 MB，"构建期间站点照常服务"在这里**做不到** ——
  #   实测不做的时候：available 594 → 157 MB，ssh 连握手都排不上队，
  #   nginx / Java / MySQL 一起对外超时，部署卡在构建上 27 分钟没动。
  #   宁可诚实地停几分钟，也不要不受控地锁死整机（锁死时更糟：那是整个机器不可用）。
  local was_running=0
  if [ "$(rsh "systemctl is-active $SERVICE" || true)" = "active" ]; then
    was_running=1
    say "先停掉 $SERVICE，把内存让给构建（这台机器上做不到零停机构建）"
    rsh "systemctl stop $SERVICE"
  fi

  say "构建到 .next-new（不碰正在服务的 .next）"
  local t0 t1
  t0=$(date +%s)
  # ★ 上一次半途而废的产物不许混进来（`next build` 会往已存在的目录里写）
  rsh "rm -rf $APP_DIR/.next-new"
  # ★ 两个救命参数，理由写在 next.config.ts 与本节上面：
  #   NEXT_BUILD_CPUS=1 —— 串行静态生成（默认按 CPU 数开 worker，那台机器是 2 个）
  #   --max-old-space-size=512 —— 堆小、GC 勤、峰值 RSS 低：宁慢不炸
  if ! rsh "sudo -u xzj env HOME=/var/cache/xiaozhujue bash -lc 'cd $APP_DIR && NEXT_BUILD_CPUS=1 NODE_OPTIONS=--max-old-space-size=${XZJ_BUILD_HEAP:-512} NEXT_DIST_DIR=.next-new pnpm build'"; then
    rsh "rm -rf $APP_DIR/.next-new"
    if [ "$was_running" = "1" ]; then rsh "systemctl start $SERVICE"; fi
    die "构建失败（正在服务的那一份没动过）"
  fi
  t1=$(date +%s)
  say "构建耗时 $((t1 - t0)) 秒"

  say "换目录并重启（停机只有 mv 那一下）"
  rsh "set -e; cd '$APP_DIR'; systemctl stop $SERVICE; rm -rf .next-old; mv .next .next-old 2>/dev/null || true; mv .next-new .next; systemctl start $SERVICE"

  say "冒烟（最多等 60 秒，每 3 秒问一次）"
  local code
  for i in $(seq 1 20); do
    code="$(rsh "curl -s -m 5 -o /dev/null -w '%{http_code}' 127.0.0.1:$PORT/" || true)"
    if [ "$code" = "200" ]; then
      say "第 $i 次问到了：/ = 200"
      break
    fi
    if [ "$i" = "20" ]; then rollback; die "等了 60 秒还是 $code，已自动换回上一份 .next"; fi
    sleep 3
  done

  # ★ 「服务活着」证不了新代码上去了 —— 所以判据落在**新构建**里有没有你刚改的那句话。
  if [ -n "$expect" ]; then
    say "判据：新构建里搜「$expect」"
    rsh "grep -rl -- '$expect' '$APP_DIR/.next' | head -3" | grep -q . \
      || { rollback; die "新构建里搜不到「$expect」——这份构建不含你的改动，已换回上一份"; }
    say "命中 ✓"
  else
    say "（没给 --expect，只验了服务活着。要判别真假请带上 --expect='你刚改的那句话'）"
  fi

  say "完了。外面那一侧要人看一次：手机打开 http://${HOST##*@}/"
  rsh "systemctl is-active $SERVICE; echo '--- 最近日志 ---'; journalctl -u $SERVICE -n 5 --no-pager"
}

rollback() {
  say "换回上一份 .next"
  rsh "set -e; cd '$APP_DIR'; [ -d .next-old ] || { echo '没有 .next-old 可回'; exit 1; }; systemctl stop $SERVICE; rm -rf .next; mv .next-old .next; systemctl start $SERVICE"
  sleep 2
  rsh "curl -s -m 5 -o /dev/null -w '回滚后 / = %{http_code}\n' 127.0.0.1:$PORT/"
}

go_live() {
  say "★ 这一步就是「上前端」本身：启用 nginx site + web unit"
  # ★ 先把占位页撤掉（`--test-page` 那一份）：它自己也 listen 80，
  #   留着会让"打到 80 的请求归谁"变成一件要读两份 conf 才说得清的事。
  rsh "rm -f /etc/nginx/sites-enabled/xiaozhujue-placeholder
       ln -sfn /etc/nginx/sites-available/xiaozhujue /etc/nginx/sites-enabled/xiaozhujue
       nginx -t && systemctl enable --now nginx && systemctl enable --now $SERVICE"
  sleep 3
  rsh "curl -s -m 8 -o /dev/null -w '本机打 80: %{http_code}\n' 127.0.0.1/; systemctl is-active nginx $SERVICE"
  say "外面那一侧（手机/另一台机器）：http://${HOST##*@}/ —— 出得来首页才算成"
}

# ══════════════════════════════════════════════════════════════════════════
# --test-page：在 80 上放一个**Nginx 直接发的静态页**，用来测"公网连不连得上"。
# ★ 它与前端无关：不经过 Next、不占 3000、不上传任何构建产物 ——
#   所以"打不开"时它能把责任干脆地切开：页面出得来 = 安全组与 80 都没问题，
#   接下来才是前端那一半的事。（`--go-live` 会把这一份自动撤掉。）
# ★ 页面里有一处 `/whoami`：它回 Nginx 眼里的 `$remote_addr`——
#   这一条顺带把"客户端 IP 到了哪一跳"变成一个看得见的数（那条按 IP 频控的
#   缺陷正是因为 BFF 不往下传这个值，见工单 10 的 Comments）。
# ══════════════════════════════════════════════════════════════════════════
test_page() {
  [ -f scripts/placeholder/index.html ] || die "没有 scripts/placeholder/index.html"
  say "上传占位页（$(wc -c < scripts/placeholder/index.html) 字节）"
  rsh "install -d -o root -g root /var/www/xiaozhujue"
  scp -q scripts/placeholder/index.html "$HOST:/var/www/xiaozhujue/index.html"

  say "写 /etc/nginx/sites-available/xiaozhujue-placeholder 并链接"
  # ★ 这里刻意**不写 `default_server`**：真站点那份带着 default_server，
  #   两份同时启用时 nginx 会因为"duplicate default server"直接拒绝启动。
  rsh 'cat > /etc/nginx/sites-available/xiaozhujue-placeholder' <<'NGINXEOF'
# xiaozhujue-placeholder —— 只用来测连通性的静态占位页（`deploy-web.sh --test-page`）
# ★ 它不经过 Next（前端那一半没上线），所以"这一页打得开"与"前端能跑"是两件事。
server {
  listen 80;
  server_name _;

  root /var/www/xiaozhujue;
  index index.html;

  location / {
    add_header Cache-Control "no-store" always;
    try_files $uri $uri/ =404;
  }

  # 给页面用的一处动态返回：Nginx 眼里的客户端地址
  location = /whoami {
    default_type text/plain;
    add_header Cache-Control "no-store" always;
    return 200 "$remote_addr\n";
  }
}
NGINXEOF

  say "启用（nginx 从这一刻开始对外）"
  rsh "ln -sfn /etc/nginx/sites-available/xiaozhujue-placeholder /etc/nginx/sites-enabled/xiaozhujue-placeholder
       nginx -t && systemctl enable --now nginx && sleep 1
       curl -s -m 5 -o /dev/null -w '本机打 80: %{http_code}\n' 127.0.0.1/
       curl -s -m 5 127.0.0.1/whoami | sed 's/^/whoami 回: /'
       systemctl is-active nginx"

  say "★ 现在从**外面**（手机、另一台机器、或手机流量）打开：http://${HOST##*@}/"
  say "  打得开 = 安全组放行了 80；打不开 = 先去阿里云控制台看入方向规则（我在透明代理后面测不准）"
  say "  撤回这一页：ssh 上去 rm 掉 sites-enabled 那个链接再 reload（或直接 --go-live 换成真站点）"
}

# ★ `--expect=...` 可以出现在任意位置，所以先剥出来再分派。
#   写这段是因为 `[ x ] && cmd` 在 `set -e` 下会要命：条件不成立时整条列表返回 1，
#   脚本当场退出 —— 而那种退出看起来像"命令本身失败了"。
EXPECT=""
rest=()
for arg in "$@"; do
  case "$arg" in
    --expect=*) EXPECT="${arg#--expect=}" ;;
    *) rest+=("$arg") ;;
  esac
done
set -- ${rest[@]+"${rest[@]}"}

case "${1:-}" in
  --provision) provision ;;
  --assets)    sync_assets ;;
  --test-page) test_page ;;
  --full)      deploy 1 "$EXPECT" ;;
  --go-live)   go_live ;;
  --rollback)  rollback ;;
  "")          deploy 0 "$EXPECT" ;;
  *)           die "不认识的参数：$1（见文件头用法）" ;;
esac
