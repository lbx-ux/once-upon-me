# 10 —— 整个站上服务器（Nginx + Next 生产 + 数据目录分离）

`Status:` **done**（2026-10-19 上线：install 42 秒 → 构建 72 秒 → 外网首页 200，
过程与两次翻车记录见文末 Comments。★ 还剩两件**只有人能做**的验收：手机打开首页、
线上生成一本新书）

## 要做什么

```
公网 ──:80──> Nginx ──┬── /         ──> Next.js 生产 127.0.0.1:3000
                      └── /backend/  ──> Spring 127.0.0.1:8080（要 X-Internal-Token）
```

- 装 `node 24` + `pnpm`；`/opt/xiaozhujue/app/` 放源码与 `.next`。
  ★ **必须在服务器上构建**：本机没有 Docker，而 sharp 是原生模块，
  Windows 产物在 Linux 上跑不起来。
- ★ **加 2 GB swap**：`pnpm build` 与 sharp 现缩一张 3 MB PNG 都会冲一下内存，
  2C2G 不加 swap 会在某个不该的时刻 OOM。这是本节唯一不能省的一步。
- `ASSET_ROOT=/var/lib/xiaozhujue/assets`（**数据与代码分开**：
  部署时 `rsync --delete` 不许碰作品，合在一起手一抖就是一次真实的数据损失）。
- `/etc/xiaozhujue/web.env`（600）：全部密钥 + `BACKEND_URL=http://127.0.0.1` +
  `INTERNAL_TOKEN`，由 systemd 的 `EnvironmentFile` 挂进来。
- Nginx 四行必须写对：`client_max_body_size 24m`（录音克隆要传音频）、
  SSE 那条 `proxy_buffering off` + `proxy_read_timeout 900s`
  （默认 60 秒会在第 1 页就掐断整本生成）。
- `scripts/deploy-web.sh`：`rsync` 源码（排除 node_modules/.next/.out/.git/.next*）
  → `pnpm install --frozen-lockfile` → `pnpm build` → `systemctl restart xiaozhujue-web`。
- 一次性：把本机 `.out/web`（66 MB）搬到 `/var/lib/xiaozhujue/assets/`。
- 本机 `.env.local` 加 `BACKEND_URL=http://123.56.148.105/backend` +
  `INTERNAL_TOKEN`（本地开发时 Next 打的是 Nginx 那条内部通路，不必再起一个 Java）。

## 怎么算做完

- **从另一台机器**（手机）打开 `http://123.56.148.105`：首页出得来、能登录、
  能看到已有的书与角色卡。★ 这是本轮的总判据。
- 线上生成一本新书：`/var/lib/xiaozhujue/assets/books/<id>/` 里出现 `page-*.png`，
  换一台设备打开仍能看（含缩略图）。
- `systemctl status xiaozhujue-web` / `xiaozhujue-api` 都是 active；
  服务器重启之后两个都自己回来。

- 2026-10-17（工单 03 做完之后的补充）：**内部令牌必须与后端那一把逐字相同**，
  否则 BFF 打过去是 403（服务器上实测过：不带 `X-Internal-Token` 打
  `/api/auth/login` 回 403）。服务器上两处的取法：
  `ssh root@123.56.148.105 "awk '/^  internal-token:/{print \$2}' /etc/xiaozhujue/api.yml"` ——
  写 `web.env` 时**照抄**它，不要另生成一把。`/api/health` 是唯一豁免那条令牌的路。
- 2026-10-17：短信在服务器上当时是**假发**（`api.yml` 里 `app.sms.enabled: false`，
  码固定 123456）。
  ★ **2026-10-19 更正：已经不是假发了。** `api.yml` 当天 12:46 改过、服务 12:46:26 重启，
  现在是 `enabled: true` + 四把钥匙齐全（`sms_send_log` 里 12:46:57 有一条真实发送记录）。
  所以「上线那天要把它改成真发」这句**作废**——它现在就是真发。
  真发之后要盯的是另外两件事：每天 300 条那条硬顶仍然生效，以及下面那条按 IP 频控的缺陷。
- ★ 2026-10-19（准备那天读代码读出来的，写在这里因为它会直接改上线后的行为）：
  **按 IP 那两层频控在线上会退化成"全站共用一格"。** `src/lib/auth/backend.ts` 只送
  `X-Internal-Token` / `Content-Type` / `Authorization` 三个头，**不转发客户端 IP**；
  而 Java 那边 `ClientIp.of()` 读的是 `X-Forwarded-For` → `X-Real-IP` → `getRemoteAddr()`，
  在"BFF 从回环连过来"这一跳上恒为 `127.0.0.1`。于是 `same-ip-hourly: 5` /
  `same-ip-daily: 20` 变成**全站**每小时 5 条、每天 20 条（离全局 300 那条硬顶远得很）。
  判据已经在库里：`sms_send_log` 唯一一行的 `ip` 就是 `127.0.0.1`。
  修法是让 BFF 把客户端 IP 透传给 Java，**要在前端上线之前做掉** —— Nginx 一开
  这个缺陷就对外可见了，而它长得像"用户手滑连点"。
  ★ **2026-10-19 当天已修**（见下面 Comments 里那一条"修好了 + 判据"，含真链路实测）。

---

## Comments

- 2026-10-19（**只做准备**：用户当天明确"先不要部署前端在上面，把除前端内容的其他准备部署好"）：
  新增 [`scripts/deploy-web.sh`](../../../scripts/deploy-web.sh)，一个脚本四种用法：
  `--provision`（一次性、幂等）/ `--assets`（搬作品）/ 默认与 `--full`（日常部署，后者带 `public/`）
  / `--go-live`（启用 Nginx site + web unit，**这一步才是"上前端"**）/ `--rollback`（秒级换回）。
  服务器现状（下面每条都是实测读数，不是"配好了"）：
  · `node v24.22.0`（apt 自带的 nodejs 是 18.19，太老，走 NodeSource 装的 24）
  - `pnpm 12.14.0`（与开发机同大版本）+ `nginx 1.24.0`；`/opt/xiaozhujue/app`（属主 xzj）已建。
    · `/etc/xiaozhujue/web.env`（640 root:xzj）：模型那五组密钥从本机 `.env.local` 取，
    `INTERNAL_TOKEN` 与 `APP_JWT_SECRET` 在服务器上从 `api.yml` 现读**照抄**，
    `BACKEND_URL=http://127.0.0.1:8080`。20 个键全部有值（只核过"有没有值"，从头到尾没打印过值）。
    · `xiaozhujue-web.service` **已写好但 `disabled` / `inactive`**；
    `/etc/nginx/sites-available/xiaozhujue` **已写好但没有链接**，nginx 是停的、
    Ubuntu 那个默认站点已从 `sites-enabled` 拿掉 —— 所以 **80 端口现在没有任何人在听**
    （`ss -lntp` 实测）。那份 conf 用"临时链接 → `nginx -t` → 取消链接"验过语法，OK。
    · `--assets` 把本机 `.out/web/u`（183 MB / 238 个文件）搬进 `/var/lib/xiaozhujue/assets`，
    两边文件数与逐片体积核对一致，属主 `xzj:xzj`。
    ★ 作品按 `u/<userId>/` 分片，而**两边的 id 不一定一一对应**：本地那份记录里 `100000`
    是 userId 2，服务器上 `100000` 也是 id 2 —— 所以 `u/1`（126 MB，种子账号 `123456`）与
    `u/2` 这两片**看起来对得上**（u/1 这一条没有真验过，判据是登录之后书架里有没有书）。
    其余几片（5/17/18/20/22/25，约 56 MB）是本地那个 H2 里才有的账号，搬上去也
    **没人看得到**，除非那些手机号在服务器上注册成同样的 id（工具：`scripts/adopt-legacy-assets.mts`）。

- 2026-10-19：四处**只有真做才会暴露**的东西，都是照字面做就会踩的：
  1. **本机没有 rsync**（Git Bash 不带；服务器上有 3.2.7）。本工单原文那句「`rsync` 源码」
     在开发机上跑不起来 —— 上传改走 `git archive` + `scp`。
  2. **只能 `git archive` 打包，不能用 `tar` 打工作区**：前者按 `.gitattributes` 的
     `eol=lf` 输出 LF，而工作区里还有一批 CRLF 文件（`patches/*.patch` 尤其怕这个，
     CRLF 的 diff 会应用失败）；而且它只含**已跟踪**文件，排除表不会漂。
     ★ 代价：`deploy-web.sh` 部署的是 **HEAD**，工作区里那些未提交的改动**不会上去**——
     脚本会在工作区不干净时吼一声，但**不拦**（不拦的理由：有时就是要部署已提交的那一份）。
  3. **`MODEL_CONFIG_FILE` 不能按 `.env.example` 那句放 `/etc/xiaozhujue/models.json`**：
     管理页写它是"临时文件 + rename"（`lib/settings/runtime-config.ts`），而 rename 要的是
     **目录可写** —— 那个目录是 `750 root:xzj`，服务以 `xzj` 跑，写不进去
     （症状是"管理页上明明改了却不生效"）。改放 `/var/lib/xiaozhujue/models.json`。
  4. **`xzj` 的家目录就是 `/var/lib/xiaozhujue`**（`getent passwd xzj` 实测），而 pnpm 的
     store 默认落在家目录下：装一次依赖就会往**作品目录**里塞 600 MB 缓存，
     于是 `du -sh /var/lib/xiaozhujue` 不再等于"作品有多大"——而工单 11 那条"到 70%
     提醒一次"的读数正是靠它。安装与构建一律 `HOME=/var/cache/xiaozhujue`，缓存归缓存。

- 2026-10-19：**写脚本当天自己踩的两个**，记下来免得重犯（都和 bash 的展开时机有关）：
  · systemd unit 用**未加引号**的 heredoc 写（要展开 `$APP_DIR` / `$pnpm_bin`），于是注释里
  那一对反引号被本地当成**命令替换**执行掉了：脚本打出一句 `-: command not found`，
  落到服务器上的 unit 里那句注释少了半句。规则：这种 heredoc 的注释里不许有反引号。
  · unit **必须有 `[Install]` 段**：缺了它 `systemctl is-enabled` 回的是 `static`，
  而 `--go-live` 第一步的 `enable` 会直接失败。第一次跑就是这个结果，已补并复跑验证。
  · 顺带一条通用陷阱：`set -e` 下 `[ x ] && cmd` 会要命 —— 条件不成立时整条列表返回 1，
  脚本**当场退出**，而那种退出看起来像"命令本身失败了"。脚本里两处已改成 `if`。

- 2026-10-19：**明确没做的**（都是刻意留的，不是漏项）：
  · 前端本体：没有构建、没有启用任何 unit 或 Nginx site —— 80 端口还是空的。
  上线那一刻是：先 `bash scripts/deploy-web.sh`（送代码与构建），再 `--go-live`。
  · 安全组只留 22/80：阿里云控制台里点，我在一层透明代理后面测不准（与工单 11 同一条）。
  工单 11 那三件"只能人做"的事里，剩下这条与"外网只看到 80"的验证要等前端真上线。
  · ~~那条按 IP 频控的缺陷没改~~ —— **当天改掉了**，见下一条。

- 2026-10-19（当天追加，用户要"测一下能不能连上"）：`--test-page` 在 80 上放了一个
  **Nginx 直接发的静态页**（`scripts/placeholder/index.html` → `/var/www/xiaozhujue/`），
  不经过 Next、不占 3000、不上传任何构建产物 —— 所以这一页打得开**只**证明
  "公网 → 安全组 → 80 → Nginx"这条路通，与前端能不能跑是两件事。
  实测（2026-10-19 14:23）：服务器本机 `curl 127.0.0.1` 回 200 / 3934 字节；
  从开发机打 `http://123.56.148.105/` 也回 200 / 3934 字节，而**服务器访问日志里
  那一条的客户端地址是 `218.26.81.8`**（山西联通的公网 IP）。
  ★ 那条日志才是"公网真的到了"的判据 —— 本机自测（`127.0.0.1`）证明不了安全组。
  于是工单 11 那三条"只能人做"里，"外网只看到 80 开着"这一条**部分落实**：
  80 确实从公网可达；443 / 3306 / 8080 该收的那一步仍然要人在阿里云控制台点。
  · 页面里顺手做了两件事：一段 `/whoami`（回 Nginx 眼里的 `$remote_addr`，让
  "客户端 IP 到了哪一跳"看得见 —— 那条按 IP 频控的缺陷正是 BFF 不往下传这个值），
  以及 `Cache-Control: no-store`（测试页被浏览器缓存住会让人误判）。
  · 那份 conf **刻意不写 `default_server`**：真站点那份带着它，两份同时启用会让 nginx
  因 "duplicate default server" 拒绝启动；而 `--go-live` 会先把占位页这一份撤掉。

- 2026-10-19（**缺陷修好了**：按 IP 频控那条）：改了三个文件 + 一个新测试文件。
  · `src/lib/auth/backend.ts`：新增 `clientIpFrom(request)`，并给 `backendFetch` 加
  `init.clientIp` —— 给了就发 `X-Forwarded-For: <那个值>`（Java 读第一段，所以只放
  一个值，"客户端是谁"只有一个答案）；不给就不发这个头，Java 于是退回"回环地址"
  这个**已知**现状，而不是收到一个空值。
  · `src/app/api/auth/send-code/route.ts`：把 `clientIpFrom(request)` 传进去
  （Java 那边只有 `AuthController.sendCode` 在用客户端 IP，所以只改这一处）。
  · `src/lib/auth/backend.test.ts`（新，9 条）。
  ★ **取值顺序不能照抄第一段**，这是这条修改真正的技术内容：Nginx 的
  `$proxy_add_x_forwarded_for` 是**追加**，客户端自带的 `X-Forwarded-For` 会排在最左边，
  而 Java 读的正是最左边 —— 照抄它 = 谁都能换着填 IP 绕过那两层（而"按 IP"是挡
  "一个人换 IP 刷短信"的唯一闸门）。所以：**先认 `X-Real-IP`**（Nginx 用 `$remote_addr`
  覆盖写，伪造不了），没有它才取 `X-Forwarded-For` 的**最后一段**；值不像 IP 就回
  `null`（宁可退回现状，也不让随手编的字符串变成频控的键）。
  · 判据分两层。**单元**：9 条用例钉住"取值顺序"与"这个头真的发出去了"，
  并**反证过**——把实现改成取第一段，恰好那两条规则用例变红（其余 7 条不动），
  说明它们不是空跑；`pnpm test` 全绿（89 个文件 1083 条）。
  **真链路**（这一条才是"只有真做才会不同"）：在服务器上临时把 `app.sms.enabled`
  改成 `false`（devMode：不花钱、码固定 123456，改前留了 `api.yml` 备份，
  且**先用 grep 断言改动生效再发**——不然那一步会真的发短信出去），重启后端，
  然后**直连回环 8080**（就是 BFF 那一跳的形状）打一次 `send-code`，
  带一个合成 IP `203.0.113.9`：

  ```
  库里最新一行：  203.0.113.9   2026-10-19 14:36:19   ← 修好了
  旧行为那一条：  127.0.0.1     2026-10-19 12:46:57   ← 缺陷的指纹
  ```

  随后配置已原样恢复（`enabled: true` + 后端 200，实测）。
  · 那次探针的"反向对照"（不带这个头）**没拿到**：第二发落在同号 60 秒窗口里，
  被回成 429、于是没有新账（`rateLimiter` 记在发送之后）。这不是探针坏了——
  它顺带证明了那三层频控在线上是活的。对照由 12:46 那条历史数据补上。
  ★ **还差的那一条，2026-10-19 21:54 做掉了**（前端上线当天，比原计划只晚了半天）：
  从**公网**打 `POST /api/auth/send-code`（临时 devMode，不花钱），`sms_send_log`
  新那行记的是 **`183.203.206.235`** —— 一个真实公网客户端 IP，不是 `127.0.0.1`。
  同一秒 nginx 访问日志里那条请求的客户端也是同一个人：两处对上，整条链是通的 ——
  客户端 → Nginx（写 `X-Real-IP`）→ Next 的 BFF（读它、写进 `X-Forwarded-For`）→
  Java 的 `ClientIp.of()`（取第一段）→ MySQL。修好了，而且是**真跑过一次**的修好。
  · 顺带一条**没测**的：Nginx `location /backend/` 那条 pass-through（客户端自带的
  XFF 会不会被透传）—— 当前 80 上只有占位页、真站点没链接，所以那一跳现在不存在。
  它不在生产路径上（生产是 BFF 直连回环 8080），只影响"开发机借服务器后端"那条路，
  到真要用它的时候再验。

- 2026-10-19 21:50（**上线了**）：HEAD `43bc863` → 最终跑在线上的是 `5cdabcb`。
  完整读数：全量包 62 MB（首次必须带 `public/`）→ `pnpm install` **42 秒** →
  构建 **72 秒** → 冒烟第 2 次问到 200 → 判据（新构建里搜 `/api/auth/sms/send`）命中。
  接着 `--go-live`：nginx 换站 + 两个 unit enable，外网实测 `/` 39553 字节（含「开始创作」）、
  `/login` 200、`/booklist` 200。
  · 之后为验那条 IP 转发，临时 devMode 打了一次公网 `send-code`，配置随即恢复
  （`enabled: true`），四个服务 `active/enabled`。
  ★ **两次整机锁死**，都在同一件事上，记下来因为它们的代价是"人去控制台强制重启"：
  · 第一次（21:00–21:35）：默认参数（2 个 worker + 1 GB 堆）。`available` 594 → 157 MB，
  ssh 握手排不上队，nginx/Java/MySQL 一起对外超时，构建卡在
  `Creating an optimized production build ...` 27 分钟没动。
  · 第二次（21:36–21:48）：串行 + 512 MB 堆 + 停 web，**还是锁死**。
  · ★ 第二次的日志给出了真凶：`✓ Compiled successfully in 37.3s` —— webpack 只要 37 秒，
  卡死整机的是**紧接着的 `Linting and checking validity of types`**（tsc 与 ESLint
  都在构建进程里跑）。于是修法从"调内存"变成"把那一关拿掉 + 给它套边界"：
  `NEXT_SKIP_GATES=1`（口径同 `server/deploy.sh` 跳过测试：闸门是提交前的事）、
  `NEXT_BUILD_CPUS=1`、`--max-old-space-size=512`、构建期间停 mysql/java/web，
  并用 `systemd-run --scope -p MemoryMax=1400M -p MemorySwapMax=0` 把构建框住 ——
  ★ `MemorySwapMax=0` 是关键：不许它用 swap，"装不下"当场变成"构建失败"，
  而不是"整机锁死、只能去控制台"。改完之后 72 秒建完，机器内存没进过 swap。
  · ★ 另一处翻车（同日，`--go-live`）：改完 `sites-enabled` 只做了
  `systemctl enable --now nginx`，而 nginx **本来就在跑**（测连通性那阶段起的）——
  `enable --now` 对已在运行的进程什么都不做，它继续用内存里那份旧配置：
  `/` 还回占位页（3934 字节）、`/login` 回 404。**而当时那条判据「本机打 80: 200」
  被占位页满足了**，当场通过、什么也没拦住。修法两条：换完必须 `reload`；
  判据改成搜一句只有真站点才有的文案。★ 这条值得单独记：状态码 200 不是判据，
  当"错的那一屏"也会回 200 时尤其不是。
  · 遗留：这台机器上**做不到零停机构建**（构建期间站点与接口都不可用，约 70 秒），
  已写进 `docs/known-tradeoffs.md`。想彻底摆脱，得把构建挪出服务器
  （WSL2 本机构建后上传 `.next`，或升到 2C4G）。

- 2026-10-19 22:10（**上线当晚的第一次翻车：两个半场的契约**）：用户手机/浏览器登录，
  页面报「服务端回的登录态不是我们认识的形状，请刷新一次试试」。
  查下来是**前后端版本不同步**：前端（当天构建）的 `parseUser` 要求
  `UserView.allowed` 这一位（后端 10-18 把 `permissions` 四个布尔收成一位），
  而服务器上跑的 jar 还是 **10-17** 构建的，只回 `permissions`。
  · 修法：`bash server/deploy.sh`（本机 `mvn package` → scp jar → 重启 → 带重试的冒烟；
  换之前先 `cp -a app.jar app.jar.bak-202610192221`）。实测 jar 44 M、第 6 次问（约 18 秒）
  回 `health=200`。
  · 判据（外网实测）：`POST /api/auth/login-password`（演示账号）回来的那份里有
  `"allowed":true`；带 cookie 再问 `/api/auth/me` 也齐了 ——
  `allowed:true` + `configured:{text,image,vision,speech}` + `speechModel`。
  · ★ 这件事值得单独记的教训：**三道闸门、构建、`--expect` 判据、冒烟全绿，
  坏的却是两半之间那一句** —— 前端与后端由两个脚本分别部署，它们的契约没有任何东西在看。
  已给 `scripts/deploy-web.sh` 末尾加了 `check_contract()`（真打一次演示账号登录，
  断言有 `allowed`；失败时直说"多半是另一半没跟着部署"）。
  · 仍留一条缝（写进 known-tradeoffs 了）：只部署后端时没人拦 —— 那条判据目前长在前端
  那个脚本上，`server/deploy.sh` 仍然只问 `/api/health`。

- 2026-10-20（**换模型钥匙**：站长报"过期了"）：钥匙只有一个落点在服务器上 ——
  `/etc/xiaozhujue/web.env`，其中 `LLM_API_KEY` / `IMAGE_API_KEY` / `VISION_API_KEY`
  **是同一把**（三个能力同一家、同一个 base URL），`TTS_API_KEY` 是另一把
  （阿里云 dashscope）。管理员页写出来的 `/var/lib/xiaozhujue/models.json` **不存在**
  （它若存在会压过 web.env —— 换钥匙前先看这一眼）。
  · 流程：`cp -a web.env web.env.bak-<时间>` → 改那三行 → `install -m 640 -o root -g xzj`
  → `systemctl restart xiaozhujue-web`（`.env` 是**进程启动时**读的，不重启不生效）。
  · ★ **判据要走计费接口**：`GET /v1/models` 新旧钥匙**都回 200**（那家网关的模型列表
  不校验钥匙），所以它证明不了任何事。真判据是应用自己那条路 —— 管理页的
  「测试连通」（`POST /api/admin/model-test`），三支实测都 `ok:true`：
  文字 1.7 s（`qwen3.8-flash`）、图像 17.2 s（`wan2.7-image`，真回图）、
  视觉 46.6 s（`kimi-k2.6`，真读了输入图）。
  · 顺带一个比"过期"更准的诊断：旧钥匙在计费接口上回的是
  **402 `INSUFFICIENT_BALANCE`（账户余额不足）**，不是 401 —— 那家后台充值即可恢复；
  而 401/403 才是"钥匙无效"。以后看到"生成失败"先看这句厂商原文
  （`lib/provider-messages.ts` 会把它翻成人话并原样附上）。
  · 本机 `.env.local` 里那三把是**另一把**（指纹与服务器不同），本次没动。

- 2026-10-28（**HTTPS**：备案下来之后收口「先 IP + HTTP」那一笔）：
  域名 `lbx99.xyz` / `www.lbx99.xyz` 的 A 记录本来就指着这台机器
  （从服务器上 `nslookup @223.5.5.5` 读的，不是猜的），所以这一步只剩证书与 conf。
  做了这些：
  · `apt install certbot`（2.9.0）→ `/var/www/certbot` 作 ACME webroot。
  · `certbot certonly --webroot -d lbx99.xyz -d www.lbx99.xyz` 一次签成，
  到期 2027-01-26；`certbot renew --dry-run` 全绿（staging）。
  · conf 改成两块：80（ACME + 开发机 `/backend/` 原样，其余 `301 https://lbx99.xyz`）
  - 443（`ssl_certificate` 那套 + `HSTS max-age=31536000`，**不加** includeSubDomains）。
    ★ 301 的目标**写死域名**：从 `http://123.56.148.105` 进来时 `$host` 是那个 IP，
    跳到 `https://IP` 会撞上证书名不符（一整页红警告）。
    ★ **不写 `ssl_stapling`**：LE 2025 年起不给 OCSP，加了每次 reload 都吐
    `ssl_stapling ignored, no OCSP responder URL`（实测）。
    · 续期钩子：`/etc/letsencrypt/renewal/lbx99.xyz.conf` 的
    `renew_hook = systemctl reload nginx`（没有它，续下来的证书要等下一次 reload 才生效）。
    · `scripts/deploy-web.sh`：conf 那段换成上面这份；新增 `--tls`
    （幂等：有证书就 `renew --no-random-sleep-on-renew`，没有就签）；`--go-live`
    先判证书在不在、判据改成 https。★ 新机器上的顺序：`--provision` → `--tls` → `--go-live`。
    · 判据（都是实测，不是"配好了"）：外网 `https://lbx99.xyz/` **200**、
    `ssl_verify_result=0`、`Subject CN=lbx99.xyz` / SAN 两个名字；
    `http://123.56.148.105` 与 `http://lbx99.xyz` 都 **301 到 `https://lbx99.xyz/`**
    （带路径的 `/studio?x=1` 也原样带过去）；响应头有 `Strict-Transport-Security`；
    **443 在安全组里是开的**（从开发机打真 IP 通，不用改控制台）；
    演示号在 https 上登录 **200**，首页 HTML 里**没有** `http://` 绝对地址（无混合内容）。
    · cookie `secure`：`session.ts` 的 `isHttps()` 按 `x-forwarded-proto` 判，
    本机 http 不误伤；**已提交并部署**（`5867c50` / `63a52da`，同一天）。
    判据：https 上登录回的 `set-cookie` 里 `Secure; HttpOnly; SameSite=lax` 全在，
    拿着这张票打 `/api/auth/me` 回 `allowed:true`（环回一次，票存得下、带得回）。
    · ★ 合规项：页面底部挂备案号（`晋ICP备2026016635号-1`，链到 `beian.miit.gov.cn`）。
    《互联网信息服务管理办法》要求挂出来，这一条与证书无关。
    落点三个：首页最底（`components/site/IcpNotice.tsx` + `.icp--home`）、`/login` 页脚、
    `/privacy` 纸底。★ 首页那一块会把文档总高 \(+87px\)，而第二屏的量程由
    `enterExitSpan` 拿 `maxScroll` 夹一次——**改前改后都量过**，量程没变（夹的那一下没生效），
    `chk-mobile.mjs` 76/76。读数在 `docs/known-tradeoffs.md`「首页最底那一行备案号」。
    ★ **没挂**在工作台那五屏（`AppShell`）：底栏在手机上是一条贴底的标签栏，
    再塞一行会把那五个 44×44 的触控目标挤掉；备案审核看的是首页。
