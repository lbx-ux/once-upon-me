# 服务器到期之后：把整个站搬回本机

**服务器只租到 2027-04-15。** 这一页是那天要照着做的东西。

---

## 第一件要说清的事：本机那份是「拉过才算」的那一份

`D:\xiaozhujue-data\` 里那份镜像**不是自动同步的**。它是你上一次跑
`scripts/pull-from-server.sh` 那一刻的快照：

- **两次 pull 之间在服务器上生成的书，本机没有**；
- 所以到期前**必须最后跑一次**，而且要**全量**：

```bash
LOCAL_MIRROR_DIR=D:/xiaozhujue-data ./scripts/pull-from-server.sh --full
```

（不带 `--full` 是增量，判据是"文件数 + 总字节"的指纹——那对日常够用，
而最后一次要的是**一模一样**，不是"看起来变了没有"。）

拉完立刻验它**自足**（每一本书清单引用的每个资产都在本机）：

```bash
node scripts/verify-mirror.mts --dir=D:/xiaozhujue-data/assets
```

★ 它红了就**别继续**：那份镜像现在恢复不了，而那天没有服务器可问。

## 三样东西，缺一样都搬不回来

| 什么                                    | 在哪                                             | 怎么确认它在                             |
| --------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| **作品**（图 / 朗读 / 清单的字节）      | `D:\xiaozhujue-data\assets\u\<userId>\…`         | `verify-mirror.mts` 绿                   |
| **数据库**（账号 / 权限 / 音色 / 申请） | `D:\xiaozhujue-data\db\xiaozhujue-<日期>.sql.gz` | `gzip -t` 过、里面有 `INSERT INTO users` |
| **代码**                                | 本仓库（git）                                    | `git log` 里那个提交                     |

★ 写在这里是因为有人会以为"有作品就够了"——**不够**：没有库，那些书在界面上
不属于任何人（归属是 `u/<userId>/` 那个前缀，而"谁是 userId 1"在库里）。

## 搬回本机的步骤

1. **装 MySQL 8**，建库（字符集必须是 utf8mb4）：

   ```sql
   CREATE DATABASE xiaozhujue DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'xzj'@'localhost' IDENTIFIED BY '<新口令>';
   GRANT ALL PRIVILEGES ON xiaozhujue.* TO 'xzj'@'localhost';
   ```

2. **灌快照**（先 `gzip -t` 验一遍，再灌）：

   ```bash
   gzip -t D:/xiaozhujue-data/db/xiaozhujue-<日期>.sql.gz
   gzip -dc D:/xiaozhujue-data/db/xiaozhujue-<日期>.sql.gz | mysql -uroot xiaozhujue
   ```

   灌完数一眼：`SELECT account, role FROM users;` —— 至少该有一个 `ADMIN`。

3. **起后端**：本机用 `local` 档跑的是 H2，而这一份是 MySQL。所以要么
   `SPRING_PROFILES_ACTIVE=prod` 配上 `APP_DB_USER` / `APP_DB_PASSWORD`，
   要么在 `application-local.yml` 里把 datasource 换成这个库。
   更省事的一条：照服务器上那份 `/etc/xiaozhujue/api.yml` 的格式在本机写一份，
   用 `SPRING_CONFIG_ADDITIONAL_LOCATION` 挂进去。

   ```bash
   APP_JWT_SECRET=<与前端那把一致> mvn -f server/pom.xml spring-boot:run
   ```

   ★ `APP_JWT_SECRET` 必须与前端 `.env.local` 里那把**逐字相同**，
   否则症状是"登录 200、之后每个请求 401"。

4. **作品放到资产根**，并**保住 `u/<userId>/` 那一层**：

   ```bash
   # 镜像里已经是 u/ 开头了，整个搬过去就是对的
   cp -r D:/xiaozhujue-data/assets/*  <仓库>/.out/web/
   ```

   ★ 别把它们摊平到 `.out/web/books/`：代码只认 `u/<userId>/` 底下那一片，
   摊平之后书架**会是空的**（而且不报错——它只是什么都看不到）。

5. **起前端**：

   ```bash
   pnpm dev
   ```

   打开 `http://localhost:3000`，用管理员号进去看管理页——**每个用户的作品数**
   那一列是"搬回来了没有"最直接的判据（它数的是磁盘上的路径）。

## 那天之前可以先做的演练

★ 这一页的每一步**现在就能在另一台机器上试一遍**（用同一个 `D:\xiaozhujue-data`
与一个临时库），而不必等到期那天第一次执行。恢复流程在出事当天才第一次跑，
是这类事情最贵的错。

- 唯一**测不了**的是"作品那一段"：服务器上现在还没有作品（本机那 4 本书还在
  `.out/web` 里，搬上去属于工单 10）。所以 `--dir` 那一半可以拿
  `<仓库>/.out/web` 当镜像验同一件事：

  ```bash
  node scripts/verify-mirror.mts --dir=.out/web
  ```
