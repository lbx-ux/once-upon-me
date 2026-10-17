# 03 —— Java 上服务器（JDK + MySQL + systemd）

`Status:` **done**（2026-10-17 实现；下面两处前提被实测推翻，见 Comments）

## 要做什么

在 `123.56.148.105`（Ubuntu 24.04 / 2C2G / 40G ESSD）上把这台机器安排好：

1. 装 `openjdk-17-jre-headless` + `mysql-server` 8；建库 `xiaozhujue`
   （`CREATE DATABASE ... DEFAULT CHARACTER SET utf8mb4`）与账号 `xzj@localhost`。
2. 目录：`/opt/xiaozhujue/server/`（jar）、`/etc/xiaozhujue/api.yml`（600：库口令、
   JWT 密钥、阿里云四项）、`/var/lib/xiaozhujue/`（作品，见工单 10）。
3. `systemd` unit：`SPRING_PROFILES_ACTIVE=prod`、`-Xmx320m`、`Restart=always`、
   只监听 127.0.0.1:8080。★ 服务跑在一个专用账号 `xzj` 下（不拿 root 跑 web），
   所以 `/etc/xiaozhujue/api.yml` 是 `640 root:xzj` 而不是 600 ——
   见 Comments 里那条"对工单 11 的一处偏离"。
4. ★ **收紧安全组**：★ 2026-10-17 更正——这句原来写着"现在 22/80/443/8080/3306
   都是通的（实测）"，那次实测是**从开发机探的**，而开发机在一层透明代理后面
   （连 443 与 33060 这种服务器上根本没听着的端口都报"开着"），所以那次测量**无效**。
   可信的事实是服务器上的 `ss -lntp`：**只有 sshd 绑在 `0.0.0.0:22`**，
   MySQL 与 Java 都只听回环（这一条由**绑定地址**保证，与安全组无关）。
   安全组到底开了哪几个，只能上阿里云控制台看——那一步得人来点。
5. `server/deploy.sh`：`mvn package` → `scp` jar → `systemctl restart xiaozhujue-api`
   → `curl /api/health` 冒烟。

## 怎么算做完

- `ssh root@123.56.148.105 'systemctl status xiaozhujue-api'` 是 active。
- 从服务器上 `curl 127.0.0.1:8080/api/health` 回 200。
- 从**本机** `curl 123.56.148.105:8080/api/health` **连不上**（只剩 Nginx 那条内部通路）。
- 管理员账号建出来（库里有、`role=ADMIN`）。

## Comments

- 首次 `ssh` 那一下的密码只能人来输（本机没有 sshpass，我这边无法非交互输密码）：
  在终端里输一次，然后 `ssh-copy-id` 装公钥，之后全程免密。
  ★ 2026-10-17：公钥**早就装好了**（`~/.ssh/id_rsa.pub`，`known_hosts` 里有这台机器，
  `ssh -o BatchMode=yes root@…` 直接进得去）——所以"等 ssh 密码"这个前提不成立，
  这一单当时就可以做。以后要判断"能不能上服务器"，用
  `ssh -o BatchMode=yes -o ConnectTimeout=8 root@… true` 试一下，别靠记忆。

- 2026-10-17（实现）：这一单做完了，服务器现状——
  · **swap 2G**（`/swapfile`，写进 `/etc/fstab`）。★ 内存实测 **1613 MB**，
  不是工单里写的 2048 MB（`free -m` 说的），所以 swap 那一步比原来想的更要紧。
  · `openjdk-17-jre-headless` 17.0.20.1 + `mysql-server` 8.0.46（Ubuntu 24.04.2）。
  · MySQL 只绑 `127.0.0.1:3306`（Ubuntu 默认就是，没改 cnf）；库 `xiaozhujue`
  （utf8mb4 / utf8mb4_unicode_ci）+ 账号 `xzj@localhost`。
  · 目录：`/opt/xiaozhujue/server/app.jar`、`/etc/xiaozhujue/`（750）、
  `/var/lib/xiaozhujue/assets`（归 `xzj`）。
  · unit `xiaozhujue-api`（enabled + active）：跑在 `xzj` 下、`-Xmx320m`、
  `SPRING_PROFILES_ACTIVE=prod`、`SPRING_CONFIG_ADDITIONAL_LOCATION=file:/etc/xiaozhujue/api.yml`、
  `Restart=always`，外加 `NoNewPrivileges` / `ProtectSystem=strict` /
  `ReadWritePaths=/var/lib/xiaozhujue` 那几行。
  · `server/deploy.sh`（构建 → scp → 重启 → **带重试的冒烟**）。
  实测跑通：第 6 次问（约 18 秒）才回 200——那台机器上冷启动就是要这么久。
  · 冒烟：`curl 127.0.0.1:8080/api/health` → 200；库里建出 `123456`(USER)
  与 `100000`(ADMIN) 两个号。
- 2026-10-17（实现）：**部署当晚炸出一个本机永远测不出的 bug**，值得单记——
  工单 09 那轮往 `db/schema.sql` 末尾加了一句 `CREATE INDEX IF NOT EXISTS …`，
  而那个文件的**文件头本来就写着**"MySQL 8 不支持它"。本地一直跑 H2（H2 认这一句），
  上到 MySQL 的那一刻 `spring.sql.init` 挂住，**整个后端起不来**
  （日志：`You have an error in your SQL syntax ... near 'IF NOT EXISTS idx_…'`）。
  · 修法：索引写成建表语句里的 `KEY 名字 (列)`——★ 这一步**先测再改**：
  `KEY` 那种写法在 H2 的 MySQL 兼容档（`SchemaSqlPortabilityTest` 的临时探针）
  与 MySQL 8.0.46（服务器上建了一张 `_probe_key` 再 drop）上各测过一次，
  两家都认 ⇒ 文件头那句"写在 CREATE TABLE 里的 `KEY idx (...)` H2 又不认"**是错的**，
  一并改掉了。
  · 已经建好的那张表来不及吃到建表语句里的 `KEY`，所以按文件头的老办法
  在服务器上手工 `ALTER TABLE … ADD INDEX`（幂等的那一天不存在，就手工一次）。
  · 加了一条 `SchemaSqlPortabilityTest`：把文件头那几条"只能用两家都认的写法"
  变成会红的判据。★ 它**必须先把注释剥掉**——第一版没剥，
  于是判据命中的是"解释这句禁止"的那句注释，文件正确时也红。
  反证过：把那句 `CREATE INDEX IF NOT EXISTS` 加回去，它红。
- 2026-10-17：**对工单 11 的一处偏离**（改权限那条）：工单 11 写"`/etc/xiaozhujue/*`
  一律 600；作品目录归 `xzj` 用户"——但服务如果以 `xzj` 跑，600 的配置它读不到。
  两者只能选一个：配置对谁都不可读（服务以 root 跑），或者服务不拿 root
  （配置 640 `root:xzj`）。选了后者：让一个挂在公网旁边的 Java 进程拿 root，
  比"组可读的配置"危险得多。工单 11 那一行要跟着改。
- 2026-10-17：管理员口令由服务器现场生成（`openssl rand -hex 12`），
  写在 `/etc/xiaozhujue/api.yml` 的 `app.admin.password`。要读它：
  `ssh root@123.56.148.105 "grep -A2 'admin:' /etc/xiaozhujue/api.yml"`。
  ★ 它**不在仓库里、也不在聊天记录里**——口令只有"服务器上那一份"与"你读过的那一眼"。
- 2026-10-17：短信在服务器上先**假发**（`app.sms.enabled: false`，码固定 123456）：
  真发要阿里云**号码认证服务**的 AccessKey 与签名/模板，那两把钥匙只有站长有
  （`.env.local` 里也没有）。这不影响别的功能，注册照走。
