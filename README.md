# 小主角 · Once Upon Me

> 说出孩子的名字和爱好，得到一本以他为主角、用你的声音朗读、可以反复探索的定制绘本。

**在线演示**：https://lbx99.xyz ｜ **评审账号**：`123456` / `123456`

参赛作品：**2026 第九届传智杯 · AI WEB 网页开发挑战赛**
赛道主题「智启未来：AI 驱动的 Web 应用创新挑战」｜选题方向 3：**多模态 AI 创意平台**

## 团队信息

| 项       | 内容           |
| -------- | -------------- |
| 队名     | 破晓微光       |
| 成员     | 范嘉庆、胡锦宇 |
| 学校     | 太原理工大学   |
| 参赛组别 | A 组           |
| 指导老师 | 王琦           |
| 赛区     | 北部赛区       |

---

## 一、这是什么

### 问题

市面上的个性化童书能换掉书里的**名字**，换不掉**形象和声音**。免费 DIY 那条路（豆包 + 即梦 + 剪映）要家长自己干 4–8 小时

我们做的是一个个性化内容引擎：给它一段故事，它把孩子变成主角，用父母的声音讲出来，并且保证每一页都是同一个孩子。

### 一本故事，两种形态

同一本故事，对应两个真实场景。

| 形态                             | 场景     | 交互                                                                                                                                                                |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **独读版**（线性）               | 睡前     | 全屏翻页，一屏一图一句，父母声音朗读。**不给孩子做选择的机会**——越选越兴奋，睡不着                                                                                  |
| **共读版**（一棵树，一个选择点） | 白天陪玩 | 读到选择点画面停下，出现两个大按钮；孩子不识字，所以选项走**「大图标 + 语音朗读」双通道**；选择点插一句引导性提问，把「看故事」变成「聊故事」；两条支各自收一个结尾 |

怎么证明这是同一个东西而不是两个产品？判据很土：**去掉互动，绘本仍成立；去掉绘本，互动不成立。**

形态由引擎的一个入参决定（`form`）。没有两套结构，也没有两个入口函数。

### 长什么样

四张图按用户真走一遍的顺序排：首页认识它 → 工作台说一句话 → 看它长出来的两本书。

**首页首屏**：12 张绘本封面绕成一个 3D 环，正中一句「开始创作」，底下一条通向灵感书单。

![首页首屏：一屏正中那句「开始创作」](docs/screenshots/01-home-hero.png)

**工作台 · 创作输入**：一本书的全部输入就三样——一句话、一张角色卡、一档声音。

![工作台：一句话 + 角色卡 + 声音，就是这本书的全部输入](docs/screenshots/02-studio-create.png)

**独读版阅读器**：一屏一图一句，翻页即读。刻意不给孩子做选择的机会。

![独读版阅读器：一屏一图一句](docs/screenshots/03-reader-solo.png)

**共读版 · 选择点**：故事在岔口停下，两个大按钮各带图标和朗读。这一屏之后**一次生成都不发生**——书是预生成的，阅读顺序就是你选的那条路。

![共读版：恰好一个选择点，两个大按钮，图标 + 朗读](docs/screenshots/04-reader-shared-choice.png)

### 有人真的需要它

留守儿童场景：在外打工的父母录 30 秒声音，孩子在家听爸妈读一本自己当主角的绘本。声音能跨距离，这个我们验证不了效果，但东西是照这个场景做的。

2026-10-29 起，书架上每本成品都能生成一条**只读分享链接**（`/r/<票>`）：对方不用登录、不用装东西，打开就是阅读器；默认 30 天到期，随时可以收回（收回后页面与图同时 404）。它补的是这个场景最后那段「送过去」的第一段——**离线包、导出打印、做好了通知仍然没有**，那三件在 [docs/business.md](docs/business.md) §5.4 末尾按挡不挡事排着。

一本 20 页的 API 成本实测 **¥5.8–11.6**（两个可调旋钮决定落点，量法见 `node scripts/cost-model.mts`）。"一个家庭负担得起"这句话有数撑着。成本、定价、竞品对照在 [docs/business.md](docs/business.md)。

---

## 二、技术架构

### 选型

| 层         | 选型                                                           | 为什么                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前端框架   | **Next.js 15** + React 19                                      | App Router + Server Components + 流式渲染。官方说后端只算接入层，所以页面、BFF、引擎都放在这一侧                                                                                               |
| 前端语言   | **TypeScript**（`strict: true`）                               | 引擎要能在 node 里不启动浏览器就跑通整本生成，没类型没法验                                                                                                                                     |
| 样式       | **Tailwind CSS v4**                                            | `@theme` 让设计令牌同时是 CSS 变量和工具类，一处定义两处可用                                                                                                                                   |
| 状态       | React Context + 自定义 hook + SSE                              | 跨屏共享的只有账号、音色和这一轮的事件流；没有需要全局 store 的状态，不引 Zustand / Redux                                                                                                      |
| 动效       | **GSAP 3.15**                                                  | 亮点那屏那张"被一角托起的纸"要每帧跟指针，`quickTo` 比自己写 rAF 稳。滚动驱动是自写的 `useScrollDriver` / `useScrollTick`，边界和踩过的坑在 [docs/known-tradeoffs.md](docs/known-tradeoffs.md) |
| 后端框架   | **Spring Boot 3.3.5**（Java 17）                               | 只管账号、权限、音色记录。引擎不搬进 Java                                                                                                                                                      |
| 后端数据层 | **MyBatis-Plus 3.5.7**                                         | 表只有五张（users / user_permissions / voices / sms 两张），SQL 写在 mapper 里就够，不需要 JPA 那套对象映射                                                                                    |
| 数据库     | **MySQL 8**（生产）/ **H2 文件库**（本地）                     | 建表语句只有一份 `server/src/main/resources/db/schema.sql`；本地 H2 开 `MODE=MySQL`，不用先装 MySQL                                                                                            |
| 认证       | **JJWT 0.12.6**（HS256）+ httpOnly cookie                      | 票一个字节都不回给 JS；浏览器只跟 Next 说话，Next 带 `X-Internal-Token` 打 Java                                                                                                                |
| 存储       | 磁盘资产（带内容指纹）+ MySQL 只存关系                         | 作品是文件，可逐字节比对；数据库里只有账号、权限、音色、短信记录                                                                                                                               |
| 第三方     | **阿里云短信**（dypnsapi 2.0.0）                               | 登录验证码。本地默认关（`APP_SMS_ENABLED=false`），走固定开发码                                                                                                                                |
| 部署       | **Nginx + systemd** + bash 脚本                                | 同机四件：Nginx :80 → Next 3000 / Java 8080 → MySQL 3306。前端构建到 `.next-new` 再换目录，失败自动回滚                                                                                        |
| 包管理     | **pnpm**                                                       | 安装脚本白名单能精确到单个依赖，本地和 CI 一个行为                                                                                                                                             |
| 规范       | ESLint（`next/core-web-vitals` + `next/typescript`）+ Prettier | 三条闸门（format / lint / typecheck）提交前必过；动配色再加 `check:colors` / `check:scrim`，见 [docs/commit-convention.md](docs/commit-convention.md)                                          |
| 测试       | **Vitest**（`environment: 'node'`）+ headless Chrome 探针      | 纯函数进 Vitest；GSAP 有没有真写 transform、翻页跟不跟手是浏览器事实，用真帧量，不拿 jsdom 测库的内部行为                                                                                      |

### AI落点

这张表是索引，不是自我打分。想验哪一条，按路径点进去。

| 子项           | 干了什么                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 大模型集成     | `src/lib/engine/providers/` 是能力接口 + 适配器 + 回放；`src/lib/prompts/` 带版本号，每版升级写清为什么；`src/lib/schemas/` 是自写校验器，一份定义同时出 JSON Schema 和运行时校验；`plan.ts` 负责失败定位和带反馈重试 |
| Agent / 工作流 | `src/lib/engine/illustrate.ts`：出图 → 视觉比对 → 判分 → 不达标重画。2026-10-20 起把"上一版哪几条锚点不像"注回下一次 prompt，闭环自己合上                                                                             |
| RAG            | `src/lib/rag/`：中文字符 bigram + BM25，**索引就是一个文件**，随仓库提交（[ADR-0011](docs/adr/0011-index-is-a-file-not-a-vector-db.md)）。三份语料归属分开，两条极性一次取且保证正反不重叠                            |
| 多模态         | 四种模态四家适配器：文本（故事表）、图像（出图）、语音（TTS + 声音克隆）、视觉（一致性比对 + 画面审核）。`providers/types.ts` 是接口，`registry.ts` 把环境变量接到实现上                                              |
| AI 安全        | `src/lib/engine/review.ts` 一道词表闸，三处落点：家长的自由输入、模型写出来的字、画出来的图。家长输入那一处拦下来时**一次模型调用都没发出去**（脚本量的就是这个 0）                                                   |
| MCP / 工具     | `mcp/server.mts` 是薄壳，逻辑在 `src/lib/mcp/`（手写 JSON-RPC，[ADR-0012](docs/adr/0012-mcp-server-handwritten-jsonrpc.md)），七条工具；规划那一步模型还能调四件（`src/lib/plan-tools.ts`）                           |

AI 交互那几项单独说一句，因为容易漏：规划是流式的（`plan-stream.ts`），界面上能看到它写到哪一句；失败不静默降级，`errors.ts` 抛出来，根目录 `error.tsx` 接住，`digest` 原样给用户。出图是异步的，进度走 SSE，断线能从 `/api/books/<书号>/events` 把这一轮重放出来。

### 引擎和 UI 的分界

`src/lib/engine/` 不许 import React。这条不是口号，`eslint.config.mjs` 对 engine / schemas / prompts / rag 四个目录直接禁了 `react`、`next/*`、`@/components/**`、`window`、`document`、`localStorage`。验收方式是 `node scripts/engine-run.mts --mode=stub`，不启动浏览器、不联网、不花钱，跑完一本书。

```
src/lib/engine/
├─ index.ts         四个动作：buildCharacterCard / planBook（编故事）/
│                   illustrateBook（逐页画）/ runBook（前两个的复合）
├─ domain.ts        领域类型
├─ events.ts        引擎与 UI 的 seam：事件协议，界面 / MCP / 日志共用
├─ tree.ts          扁平页表 → 故事树（纯函数）
├─ plan.ts          规划：Schema 校验 + 带反馈重试
├─ plan-shared.ts   共读版两步规划：先提纲，再逐段展开
├─ illustrate.ts    逐页生成 + 一致性核对 + 重画（Agent 落点）
├─ review.ts        内容审核
├─ providers/       types / registry / http / 四个厂商适配器 / replay
└─ character-card/  角色卡派生规则与资产读写
```

**编故事和逐页画是两个动作**，中间隔着「故事闸门」。出图是这条流水线上唯一真花钱的一步，原先它紧跟在编故事后面——家长读到故事第一个字之前，整本的钱已经花了。拆开之后，界面把那一版故事摊出来给家长逐条改，改完点「就按这个画」才出图。`runBook` 留着不是为了兼容：脚本、横评、离线跑测走它，它是那两个动作的复合，`split.test.ts` 钉着"两条路产出同一串事件、同一本书"。

RAG 的开关挂在规划那一步的一个入参上（`retrieve`），不传就是这一轮不检索。开和关是同一行代码的两个值，不是两条流水线。

### 后端只管账号

分工一句话：**密钥、引擎、作品文件在 Next 那一侧；Java 只管账号、权限和音色记录。**

| 归 Next（`src/`）                 | 归 Java（`server/`）                                         |
| --------------------------------- | ------------------------------------------------------------ |
| 模型密钥、`serverEnv()`、模型配置 | 手机号/密码、会话票、有没有创作权（一位）                    |
| 引擎、prompt、资产字节            | MySQL 那几张表：users / user_permissions / voices / sms 两张 |
| BFF 路由（`/api/*`）              | 短信频控、登录失败锁、管理页动作                             |

浏览器只跟 Next 说话，从不直接打 Java：

```
浏览器 ──同源──> Next Route Handler ──127.0.0.1:8080 + X-Internal-Token──> Java ──> MySQL
                 （httpOnly cookie xzj_session）
```

生产同机四件：Nginx :80 → Next 127.0.0.1:3000，`/backend/` → Java 127.0.0.1:8080（要内部 token），Java 再连 MySQL。作品在 `/var/lib/xiaozhujue/assets`，代码在 `/opt/xiaozhujue/`，两棵分开——合在一起手一抖就是一次真实的数据损失。

### 目录

```
once-upon-me/
├─ src/
│  ├─ app/              App Router：首页 / 登录 / 创作 / 阅读器 / 工作台（(studio)）/ API
│  ├─ components/       hero / book / booklist / scene / highlights / shell / system
│  └─ lib/              engine / rag / mcp / schemas / prompts / plan-tools + 纯函数工具
├─ server/              Spring Boot：账号、权限、音色记录
├─ mcp/                 MCP server（stdio），薄壳 + 注册说明
├─ scripts/             验收探针、横评、出图与部署（每个文件头写清它量什么）
├─ docs/                选型、成本、实测台账、ADR、出图提示词与书单
├─ public/              封面 / 演示书 / 样书 / 立绘 / 场景 / 阅读器底图
└─ CLAUDE.md            在这里怎么干活，不复述本文件
```

目录上有两条规矩。组件样式和组件同目录同名（`HeroOrbit.tsx` / `hero-orbit.css`），在 `globals.css` 里 `@import`，不用 CSS Modules——有几条规则依赖属性选择器和兄弟关系，改 Modules 收益为零。设计令牌只在 `globals.css` 的 `:root` 定义一次，组件层只消费 `var(--x)`。

命名：组件 PascalCase，纯逻辑 kebab-case，目录全小写，常量 SCREAMING_SNAKE，样式文件跟组件同名。

### 性能与手机

页面级性能对着**生产构建**量（`node scripts/chk-perf.mjs URL`）：三个视口 × 三条路由，每格 CPU ×4 节流、连跑 3 次取中位、每格冷缓存。九格全落在 Web Vitals 的「好」这一档。2026-10 那次构建上，桌面 1440×900 首页 LCP **488 ms**、CLS **0.000**、TBT **92 ms**，`/booklist` 612 ms，`/login` 524 ms，首页 First Load JS 168 kB。

本机 localhost 上的绝对秒数**不是用户侧的秒数**，没网络延迟、没真实设备，它量的是我们自己这段代码。同一份构建隔 40 分钟复跑，整片还能低三成，所以那几个秒数读作上界。稳的是两句话：都远低于 2.5 s，CLS 九格全是 0。

手机是另一副形态，不是把桌面缩进去。五个视口 × 每一条页面路由都不横向溢出（清单在脚本顶部）；看绘本时竖屏弹一层「把手机横过来」，横过来书铺到视口高的 **98.5%**，翻页钮拆进左右两条页边落在拇指下面；首页在手机上只有两节，环整块不演，**那 12 张封面一张都不取**。量法是 `node scripts/chk-mobile.mjs URL`，手机上取没取封面这条两头都量。

---

## 三、跑起来

### 环境

| 依赖    | 版本                       | 说明                   |
| ------- | -------------------------- | ---------------------- |
| Node.js | **≥ 20**（开发用 24.12.0） | Next.js 15 要求        |
| pnpm    | **10+**（开发用 12.11.2）  | 没装就 `npm i -g pnpm` |

运行期有一个原生模块 **`sharp`**（图像缩放，`/api/assets?w=` 和演示书导出都用它）。它按平台装预编译包，不需要编译脚本，所以 `pnpm-workspace.yaml` 的 `allowBuilds` 里没有它，也别加。装完 `node -e "require('sharp')"` 不报错就是通了。

`pnpm-workspace.yaml` 里另有一条 `allowBuilds.unrs-resolver`。pnpm 10.6+ 只从那里读这个配置，写在 `package.json` 的 `pnpm` 字段里会被忽略。它是 `eslint-config-next` 的传递依赖，少了 eslint 会报解析错误。

依赖清单在 [`package.json`](package.json)，运行期只有五个直接依赖。锁文件随仓库提交，`pnpm install --frozen-lockfile` 能装出我们这一份。

### 三条命令

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

```bash
pnpm dev
```

打开 http://localhost:3000 。

只跑前端也起得来，首页、演示书、登录页都在，但**登录会失败**——账号那一半在 Java 里。

### 本地起后端

```bash
& .\server\run-local.cmd
```

**用这个脚本，别直接 `mvn spring-boot:run`。** 理由只有一条：Java 不读 `.env.local`（它读进程环境），`APP_JWT_SECRET` 不带的话它会自生成一把随机的，症状是「登录返回 200，之后每个请求 401」，和"鉴权写错了"长得一模一样。这很蠢，但先按脚本来。Git Bash 里等价的一条：

```bash
set -a; . ./.env.local; set +a; mvn -o -f server/pom.xml spring-boot:run
```

后端起在哪个 H2 库上，看的是谁的工作目录。spring-boot 插件给子进程设的项目目录是 `server/`，所以上面那种写法用的是 `server/.local-db/`，**账号都在那一个里**。换成 `java -jar server/target/*.jar` 从仓库根起，会落到根目录下一个空库，症状是"我的账号怎么没了"。

### 环境变量

见 [`.env.example`](.env.example)，变量为什么这么命名都写在里面。真实密钥只写 `.env.local`，该文件在 `.gitignore` 里。仓库是公开的，密钥提交上去撤不回来。

密钥有两个落点，纪律是同一条：

| 落点                                                  | 谁写           | 什么时候用                              |
| ----------------------------------------------------- | -------------- | --------------------------------------- |
| `.env.local`                                          | 人手工写       | 开发机；也是换服务器时的随身那份        |
| `models.runtime.json`（`MODEL_CONFIG_FILE` 可换位置） | 管理页写出来的 | 站长在界面上换模型 / 接口地址 / api-key |

两者同时存在时后者压过前者（`serverEnv()` 按请求现读）。生产上建议 `MODEL_CONFIG_FILE=/etc/xiaozhujue/models.json`，把它挪出仓库目录——那是部署产物，重新部署会擦掉它。

### 管理页

`/admin` 底下四张卡（文字 / 图像 / 视觉 / 语音），每张能改三格：模型名、接口地址、api-key。

有三处不显然。改完立刻生效，不重启，因为 `serverEnv()` 每次请求现读，刻意没有模块级缓存。响应里一个 key 都不许有，只回「这一格配了没有、从哪儿来」，判据是在整个响应体里搜那五个真值。空不等于清掉，只想换模型名的人不该顺手把自己的 key 清了。

语音那一栏有个警告：克隆音色绑死在创建它时的模型上（实测跨模型 400 `[411]`），换语音模型会让用户手里那些克隆音色当场失效。这句写在卡上，不只在文档里。

### 常用脚本

| 命令                                         | 干什么                                                                |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | 三条闸门。测试 **1585 条、116 个文件**（2026-10-29 实测）             |
| `pnpm format:check`                          | 只检查不写入                                                          |
| `pnpm check:colors` / `pnpm check:scrim`     | 配色两条：扫写死的颜色；按令牌真值算对比度，掉到 4.5:1 以下就红       |
| `node scripts/engine-run.mts --mode=stub`    | 不启动浏览器、不联网、不花钱跑完一本书                                |
| `node scripts/engine-run.mts --mode=live`    | 真供应商跑一本，顺手录一份离线回放包                                  |
| `node scripts/chk-perf.mjs URL`              | 页面级性能读数，要对生产构建跑                                        |
| `node scripts/chk-mobile.mjs URL`            | 手机那一档：不横向溢出、横屏铺书、首页两副形态                        |
| `node scripts/chk-shared-reader.mjs URL`     | 共读版阅读器：阅读顺序、选完零生成、缺图兜底、键盘、断网              |
| `node scripts/chk-share-link.mts --base=URL` | 分享链接：匿名可读、过期/收回/改一字节都 404、无写按钮、零模型调用    |
| `node scripts/e2e-shared-reading.mts`        | 共读版全链路，一句话到读完（真花钱，`--until=story` 只验到闸门）      |
| `node scripts/cost-model.mts`                | 一本绘本花多少钱：价目表 + 真书的出图次数与计费字符                   |
| `node scripts/chk-admin-model.mjs`           | 管理页形状；`--live=1` 时才四种能力各真打一次                         |
| `pnpm mcp` / `pnpm mcp:session`              | 起 MCP server；或起一次真会话跑四条判据（含与 engine-run 的等价对照） |

其余脚本在 `scripts/` 里，六十来个，每个文件头写了它量什么、判据几条、修前是什么读数。别照着 README 抄，直接看脚本。

### 美术资源怎么重生成

`public/art/` 那 12 张封面由原始 JPG 转换：居中裁 16:9 → 1280×720 WebP，逐张从 q=78 往下试到 ≤130 KB。源目录和产出目录都用参数传，脚本里没有写死的路径。

```bash
python -I scripts/make-webp.py <源图目录> public/art
```

脚本有六个预设（hero / book-spread / book-cover / book-icon / theme-card / figure），不传就是 hero。**只裁不补**：源图裁完比目标窄就按原尺寸落盘并打 `偏小` 告警，绝不放大。缺的像素补不回来，放大只是把糊变成更贵的糊。

立绘那一档中间要先过一道去底，`scripts/cutout.py` 只去掉与画面四边连通的近白区，被彩铅轮廓线封住的内部白（眼白、高光）原样留着。

```bash
python -I scripts/cutout.py <立绘源图目录> .out/figures-rgba --tol 2 --choke 0 --min-island 40
python -I scripts/make-webp.py .out/figures-rgba public/figures --preset figure
```

那三个旗标是量出来的，不是默认值。改之前先读 `cutout.py` 的文件头。

各批素材的提示词、逐张体检数、验收记录都在 `docs/` 里，索引在本文末尾。文件名和 `src/lib/themes.ts` 里的 `key` 必须一一对应，对不上首屏就是一片空白。

---

## 四、原创声明与素材来源

本作品为原创，没抄、没拿开源项目包一层皮参赛。运行期依赖只有 `next` / `react` / `react-dom` / `gsap` / `sharp` 五个；引擎、供应商适配层、Schema 校验器、MCP JSON-RPC、RAG、审校词表都是自己写的。

画面素材全部由 AI 生成，提示词和验收记录随仓库提交：

| 素材                                                | 提示词文档                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 首屏 12 张绘本封面 · 工作台主题墙那 12 张小图       | [docs/cover-art-prompts.md](docs/cover-art-prompts.md)                                            |
| 演示绘本那 8 张（1 封面 + 5 跨页 + 2 枚选择点图标） | [docs/demo-book-art-prompts.md](docs/demo-book-art-prompts.md)                                    |
| 灵感书单那 12 本样书（每本 9 张图 + 8 段音频）      | [docs/booklist/](docs/booklist/README.md)                                                         |
| 输入框上方那 12 个立绘                              | [docs/figure-art-prompts.md](docs/figure-art-prompts.md)                                          |
| 亮点那 5 张卡片插画                                 | [docs/highlights-art-prompts.md](docs/highlights-art-prompts.md)                                  |
| 品牌标记                                            | [docs/brand-mark-prompt.md](docs/brand-mark-prompt.md)                                            |
| 三幕场景背景（`public/scenes/`）                    | 不在仓库里。源图尺寸、压缩后字节数、每一档雾的 α 怎么量出来的，写在 `scene-backdrop.css` 的文件头 |

两类画面都不含文字、水印或签名。
